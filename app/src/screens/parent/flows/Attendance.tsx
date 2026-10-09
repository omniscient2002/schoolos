/* ============================================================
   Attendance — per-child attendance + leave request (PU-2).
   Server truth: GET /parent/child/:id/attendance (today, 30-day %,
   history, approved-leave-aware note) and POST /parent/leave-request.
   Facts with numbers only; approved leave never counts as absence.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, Progress, Stat, useToast } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { ParentError, ParentLoading } from '../../../components/parent/states';
import { statusLabel } from '../../../lib/labels';
import { friendly } from '../../../lib/friendlyErrors';
import { fmtDate } from '../../../lib/format';
import { createLeaveRequest, getAttendance } from '../../../services/parentApi';
import { ATT_WORD, attTone, datesInRange, list, num, rec, str } from './helpers';

const LEAVE_KINDS = [
  { id: 'sick', label: 'Sick leave' },
  { id: 'medical', label: 'Medical appointment' },
  { id: 'family', label: 'Family function' },
  { id: 'other', label: 'Other' },
];

export default function Attendance({ childId }: { childId: string }) {
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const [kind, setKind] = useState('sick');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    getAttendance(childId)
      .then(d => setData(d as unknown as Record<string, unknown>))
      .catch(e => setErr(e));
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  const history = useMemo(() => {
    const rows = list<Record<string, unknown>>(data?.history);
    return rows
      .map(r => ({ date: str(r.date, r.school_date, r.at), status: str(r.status) }))
      .filter((r): r is { date: string; status: string | null } => !!r.date)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data]);

  const dates = useMemo(() => datesInRange(from, to), [from, to]);

  if (err) return <ParentError err={err} onRetry={load} />;
  if (!data) return <ParentLoading cards={2} />;

  const rawToday: unknown = data.today ?? null;
  const todayStatus = typeof rawToday === 'string' ? rawToday : str(rec(rawToday).status);
  const monthPct = num(data.month_pct);
  const note = str(data.note);

  const submit = async () => {
    if (!dates.length) { setFormErr('Choose a valid start and end date.'); return; }
    if (!reason.trim()) { setFormErr('Please write a short reason for the office.'); return; }
    setBusy(true); setFormErr(null); setSent(null);
    try {
      await createLeaveRequest({
        child_id: childId,
        childId,
        kind,
        dates,
        reason: reason.trim(),
      } as unknown as Parameters<typeof createLeaveRequest>[0]);
      setSent(`Leave request sent for ${dates.length} day${dates.length === 1 ? '' : 's'}. The school office reviews it before attendance changes.`);
      toast({ title: 'Leave request sent', sub: 'You can follow its progress under Requests.', tone: 'success' });
      setReason('');
    } catch (e) {
      setFormErr(friendly((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="u-col" style={{ gap: 16 }}>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <Stat
          label="Today"
          value={todayStatus
            ? <Badge tone={attTone(todayStatus)} dot>{ATT_WORD[todayStatus] ?? todayStatus}</Badge>
            : <span className="u-muted">Not marked yet</span>}
          sub={todayStatus ? 'The register updates each morning.' : 'The register updates here by 9:00 each morning.'}
        />
        <Stat
          label="Last 30 days"
          value={monthPct != null ? `${monthPct}%` : '—'}
          sub={
            <>
              {note ?? (monthPct == null ? 'Attendance will show once the register is marked.' : 'Present or arrived-late days.')}
              {monthPct != null && <div style={{ marginTop: 8 }}><Progress value={monthPct} /></div>}
            </>
          }
        />
      </div>

      <Card headAs="h2" head="Recent days">
        {history.length === 0 ? (
          <Empty
            icon={<Icon.Calendar size={22} />}
            title="No attendance recorded yet"
            sub="Once the class register is marked, each day appears here with its status."
            titleAs="h3"
          />
        ) : (
          <div className="u-col" style={{ gap: 4 }}>
            {history.slice(0, 30).map((r, i) => (
              <div key={`${r.date}-${i}`} className="u-between u-flex" style={{ gap: 10, padding: '8px 0', borderBottom: i === Math.min(history.length, 30) - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                <span className="u-small">{fmtDate(r.date)}</span>
                <Badge tone={attTone(r.status)} dot={!!r.status}>{r.status ? (ATT_WORD[r.status] ?? statusLabel(r.status)) : 'Not marked'}</Badge>
              </div>
            ))}
            {history.length > 30 && <div className="u-xs u-faint" style={{ marginTop: 6 }}>Showing the last 30 days.</div>}
          </div>
        )}
      </Card>

      <Card headAs="h2" head="Ask for leave">
        <p className="u-small u-muted" style={{ marginTop: 0 }}>
          Tell the office which days your child will be away. The office approves it, and approved leave is not counted as absence.
        </p>
        {sent && <div className="login-error" role="status" style={{ marginBottom: 10 }}>{sent}</div>}
        {formErr && <div className="login-error" role="alert" style={{ marginBottom: 10 }}>{formErr}</div>}

        <div className="field">
          <span id="leave-kind-label" className="u-xs u-muted" style={{ fontWeight: 600 }}>Type of leave</span>
          <div role="group" aria-labelledby="leave-kind-label" className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            {LEAVE_KINDS.map(k => {
              const active = k.id === kind;
              return (
                <button key={k.id} onClick={() => setKind(k.id)} aria-pressed={active} style={{
                  minHeight: 44, padding: '8px 13px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
                  background: active ? 'var(--accent-weak)' : 'var(--surface)', color: 'var(--text-1)',
                  fontWeight: active ? 620 : 480, fontSize: 'var(--text-sm)',
                }}>{k.label}</button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="leave-from">First day away</label>
            <input id="leave-from" className="input" type="date" style={{ width: '100%' }} value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="leave-to">Last day away</label>
            <input id="leave-to" className="input" type="date" style={{ width: '100%' }} value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
        {from && to && !dates.length && <div className="u-xs" style={{ color: 'var(--danger)', marginTop: -6 }}>The last day must be on or after the first day.</div>}

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="leave-reason">Reason for the office</label>
          <textarea id="leave-reason" className="textarea" style={{ width: '100%' }} value={reason}
            onChange={e => setReason(e.target.value)} placeholder="A short reason helps the class teacher plan." />
        </div>
        <div className="u-flex" style={{ gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <Button variant="primary" loading={busy} disabled={busy || !dates.length || !reason.trim()} onClick={submit}>
            Send leave request
          </Button>
          {dates.length > 0 && <span className="u-xs u-faint">{dates.length} day{dates.length === 1 ? '' : 's'} selected</span>}
        </div>
      </Card>
    </div>
  );
}
