/* ============================================================
   Ptm — parent-teacher meeting booking (PU-2, PAR-GAP-8).
   Server truth: GET /ptm/slots (open board, no other family's
   booking detail) · POST /ptm/book {slotId, studentId} — the server
   enforces family.child_link, so a parent books only their own child.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, useToast } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { ParentError, ParentLoading } from '../../../components/parent/states';
import { friendly } from '../../../lib/friendlyErrors';
import { fmtDate } from '../../../lib/format';
import { bookPtm, getPtmSlots } from '../../../services/parentApi';
import { clock, list, str, type FlowChild } from './helpers';

interface SlotRow { id: string; teacher: string; date: string | null; start: string | null; end: string | null; open: boolean }

export default function Ptm({ children }: { children: FlowChild[] }) {
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [childId, setChildId] = useState(children[0]?.child_id ?? '');
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [bookErr, setBookErr] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ teacher: string; date: string | null; start: string | null; childName: string } | null>(null);

  useEffect(() => {
    if (!childId && children[0]) setChildId(children[0].child_id);
  }, [children, childId]);

  useEffect(() => {
    let dead = false;
    setErr(null);
    getPtmSlots()
      .then(d => { if (!dead) setData(d as unknown as Record<string, unknown>); })
      .catch(e => { if (!dead) setErr(e); });
    return () => { dead = true; };
  }, [reload]);

  const openSlots = useMemo(() => list<Record<string, unknown>>(data?.slots).map((s, i): SlotRow => {
    const status = str(s.status) ?? (s.booked === true ? 'booked' : 'open');
    return {
      id: str(s.slotId, s.slot_id, s.id) ?? `slot-${i}`,
      teacher: str(s.teacherName, s.teacher_name) ?? 'Class teacher',
      date: str(s.date, s.slot_date),
      start: str(s.startTime, s.start_time),
      end: str(s.endTime, s.end_time),
      open: status === 'open' && s.booked !== true,
    };
  }).filter(s => s.open), [data]);

  const grouped = useMemo(() => {
    const map = new Map<string, SlotRow[]>();
    for (const s of openSlots) {
      const key = s.date ?? 'Date to be announced';
      const rows = map.get(key);
      if (rows) rows.push(s); else map.set(key, [s]);
    }
    return [...map.entries()];
  }, [openSlots]);

  const book = async (s: SlotRow) => {
    const child = children.find(c => c.child_id === childId);
    if (!child) { setBookErr('Choose your child first.'); return; }
    setBusySlot(s.id); setBookErr(null); setBooked(null);
    try {
      await bookPtm(s.id, child.child_id);
      setBooked({ teacher: s.teacher, date: s.date, start: s.start, childName: child.name });
      toast({
        title: 'Meeting booked',
        sub: `${s.teacher}${s.date ? ` · ${fmtDate(s.date)}` : ''}${s.start ? ` at ${clock(s.start)}` : ''}`,
        tone: 'success',
      });
      setReload(n => n + 1);
    } catch (e) {
      setBookErr(friendly((e as Error).message || e));
      setReload(n => n + 1);
    } finally {
      setBusySlot(null);
    }
  };

  if (children.length === 0) {
    return (
      <Empty
        icon={<Icon.Users size={22} />}
        title="No children linked"
        sub="A meeting can only be booked for a child linked to your account."
        titleAs="h3"
      />
    );
  }
  if (err) return <ParentError err={err} onRetry={() => setReload(n => n + 1)} />;
  if (!data) return <ParentLoading cards={2} />;

  return (
    <div className="u-col" style={{ gap: 16 }}>
      <div className="field" style={{ maxWidth: 320, marginBottom: 0 }}>
        <label htmlFor="ptm-child">Who is this meeting for?</label>
        <select id="ptm-child" className="input" style={{ width: '100%' }} value={childId} onChange={e => setChildId(e.target.value)}>
          {children.map(c => <option key={c.child_id} value={c.child_id}>{c.name}</option>)}
        </select>
      </div>

      <div className="u-small u-muted" style={{ lineHeight: 1.55 }}>
        Slots are opened by teachers. A slot disappears from this list once someone books it.
      </div>

      {booked && (
        <div className="login-error" role="status" style={{ lineHeight: 1.5 }}>
          Meeting booked with {booked.teacher}{booked.date ? ` on ${fmtDate(booked.date)}` : ''}{booked.start ? ` at ${clock(booked.start)}` : ''} for {booked.childName}. The school sends a confirmation message.
        </div>
      )}
      {bookErr && <div className="login-error" role="alert">{bookErr}</div>}

      {openSlots.length === 0 ? (
        <Empty
          icon={<Icon.Calendar size={22} />}
          title="No open slots right now"
          sub="When a teacher opens a meeting slot, it appears here for booking."
          titleAs="h3"
        />
      ) : (
        grouped.map(([date, rows]) => (
          <Card key={date} headAs="h3" head={date === 'Date to be announced' ? date : fmtDate(date)}>
            <div className="u-col">
              {rows.map((s, i) => (
                <div key={s.id} className="u-between u-flex" style={{ gap: 12, padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 560 }}>{s.teacher}</div>
                    <div className="u-xs u-faint" style={{ marginTop: 2 }}>
                      {clock(s.start)}{s.end ? `–${clock(s.end)}` : ''}
                    </div>
                  </div>
                  <Button variant="primary" size="sm" loading={busySlot === s.id} disabled={!!busySlot || !childId} onClick={() => book(s)}>
                    Book
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
