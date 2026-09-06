/* ============================================================
   Calendar — month grid with event chips, type/campus filters,
   day drawer with add-event modal, upcoming side panel and the
   exam-conflict policy card (max one exam per campus per day).
   ============================================================ */
import { useMemo, useState } from 'react';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Badge, Button, Card, Drawer, Empty, Modal, PageHead, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtTime } from '../lib/format';
import type { CalendarEvent, CampusId } from '../types/domain';

/* ---------- helpers ---------- */
const EVENT_TYPES: CalendarEvent['type'][] = ['exam', 'ptm', 'trip', 'deadline', 'staff', 'inspection', 'admission', 'event'];
const TYPE_COLOR: Record<CalendarEvent['type'], string> = {
  exam: 'var(--accent)', ptm: 'var(--ai)', trip: 'var(--info)', deadline: 'var(--warning)',
  staff: 'var(--success)', inspection: 'var(--danger)', admission: 'var(--campus-b)', event: 'var(--text-3)',
};
const TYPE_LABEL: Record<CalendarEvent['type'], string> = {
  exam: 'Exam', ptm: 'PTM', trip: 'Trip', deadline: 'Deadline', staff: 'Staff', inspection: 'Inspection', admission: 'Admission', event: 'Event',
};

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const daysUntil = (d: Date) => Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000);
const countdown = (d: Date) => {
  const n = daysUntil(d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n < 0) return `${-n}d ago`;
  return `in ${n} days`;
};

interface Cell { date: Date; inMonth: boolean }
function monthCells(view: Date): Cell[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const start = new Date(first); start.setDate(first.getDate() - lead);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    return { date: d, inMonth: d.getMonth() === view.getMonth() };
  });
}

const MONTH_LABEL = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ---------- screen ---------- */
export default function CalendarScreen() {
  const { session, actorName, dispatch } = useStore();
  const toast = useToast();

  const [view, setView] = useState(() => new Date());
  const [types, setTypes] = useState<Set<CalendarEvent['type']>>(() => new Set(EVENT_TYPES));
  const [campus, setCampus] = useState<CampusId | 'all'>(session.activeCampus);
  const [localEvents, setLocalEvents] = useState<CalendarEvent[]>([]);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'event' as CalendarEvent['type'], campus: session.activeCampus as CampusId | 'all', time: '09:00' });

  const all = useMemo(() => [...seed.calendarEvents, ...localEvents], [localEvents]);

  const visible = useMemo(() => all.filter(e =>
    types.has(e.type) &&
    (campus === 'all' || e.campus === campus || e.campus === 'all'),
  ), [all, types, campus]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    visible.forEach(e => {
      const k = dayKey(e.on);
      m.set(k, [...(m.get(k) ?? []), e]);
    });
    return m;
  }, [visible]);

  const upcoming = useMemo(() =>
    visible.filter(e => startOfDay(e.on).getTime() >= startOfDay(new Date()).getTime())
      .sort((a, b) => a.on.getTime() - b.on.getTime())
      .slice(0, 8),
  [visible]);

  const nextOf = (t: CalendarEvent['type']) =>
    visible.filter(e => e.type === t && daysUntil(e.on) >= 0).sort((a, b) => a.on.getTime() - b.on.getTime())[0];

  const examConflicts = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    visible.filter(e => e.type === 'exam').forEach(e => {
      const k = `${dayKey(e.on)}|${e.campus}`;
      m.set(k, [...(m.get(k) ?? []), e]);
    });
    return [...m.values()].filter(g => g.length > 1);
  }, [visible]);

  const toggleType = (t: CalendarEvent['type']) => {
    setTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };
  const clearFilters = () => { setTypes(new Set(EVENT_TYPES)); setCampus('all'); setView(new Date()); };

  const dayEvents = selectedDay ? (eventsByDay.get(dayKey(selectedDay)) ?? []).sort((a, b) => a.on.getTime() - b.on.getTime()) : [];

  const addEvent = () => {
    if (!selectedDay || !form.title.trim()) return;
    const [h, m] = form.time.split(':').map(Number);
    const on = new Date(selectedDay); on.setHours(h || 9, m || 0, 0, 0);
    const ev: CalendarEvent = {
      id: `cal_local_${Date.now()}`, title: form.title.trim(), type: form.type,
      on, durationMins: 60, campus: form.campus, owner: actorName,
    };
    setLocalEvents(list => [...list, ev]);
    dispatch({
      type: 'audit/add',
      entry: { actor: actorName, actorRole: session.roleId, action: 'Added calendar event', recordType: 'Calendar', recordRef: `${ev.title} · ${fmtDateShort(on)}`, aiInvolved: false, risk: 'low', outcome: 'Saved to the school calendar' },
    });
    toast({ title: 'Event added to the school calendar', sub: `${ev.title} · ${fmtDateShort(on)} ${fmtTime(on)}`, tone: 'success' });
    setAddOpen(false);
    setForm(f => ({ ...f, title: '', time: '09:00' }));
  };

  const cells = monthCells(view);
  const todayK = dayKey(new Date());

  return (
    <>
      <PageHead
        title="Calendar"
        sub="School calendar across campuses — exams, PTMs, trips and deadlines in one view."
        actions={
          <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => { setSelectedDay(new Date()); setForm(f => ({ ...f, campus })); setAddOpen(true); }}>
            Add event
          </Button>
        }
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {/* ---------- month grid ---------- */}
        <div style={{ flex: '2.2 1 460px', minWidth: 0 }}>
          <Card pad>
            <div className="u-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="u-flex" style={{ gap: 6 }}>
                <button className="iconbtn" aria-label="Previous month" onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() - 1, 1))}><Icon.ChevronLeft size={16} /></button>
                <div style={{ fontWeight: 620, minWidth: 148, textAlign: 'center' }}>{MONTH_LABEL(view)}</div>
                <button className="iconbtn" aria-label="Next month" onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() + 1, 1))}><Icon.ChevronRight size={16} /></button>
              </div>
              <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select className="select" style={{ width: 158 }} value={campus} onChange={e => setCampus(e.target.value as CampusId | 'all')} aria-label="Filter by campus">
                  <option value="all">All campuses</option>
                  {seed.campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={clearFilters}>Reset</Button>
              </div>
            </div>

            <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {EVENT_TYPES.map(t => (
                <button key={t}
                  onClick={() => toggleType(t)}
                  aria-pressed={types.has(t)}
                  className="u-flex u-xs"
                  style={{
                    gap: 6, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', minHeight: 32,
                    border: `1px solid ${types.has(t) ? 'var(--border-strong)' : 'var(--border)'}`,
                    background: types.has(t) ? 'var(--surface)' : 'transparent',
                    color: types.has(t) ? 'var(--text)' : 'var(--text-3)',
                    opacity: types.has(t) ? 1 : 0.75,
                  }}>
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: TYPE_COLOR[t], flexShrink: 0 }} />
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <Empty
                icon={<Icon.Calendar size={26} />}
                title="No events match the current filters"
                sub="Try widening the campus scope or re-enabling event types. Events you add appear here immediately."
                action={<Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 4 }}>
                {WEEKDAYS.map(w => (
                  <div key={w} className="u-upper u-xs" style={{ textAlign: 'center', padding: '2px 0 6px' }}>{w}</div>
                ))}
                {cells.map(({ date, inMonth }) => {
                  const evs = eventsByDay.get(dayKey(date)) ?? [];
                  const isToday = dayKey(date) === todayK;
                  return (
                    <button key={dayKey(date)}
                      onClick={() => setSelectedDay(date)}
                      style={{
                        minHeight: 86, textAlign: 'left', padding: 6, borderRadius: 'var(--r-md)',
                        border: `1px solid ${isToday ? 'var(--accent)' : 'var(--border-subtle)'}`,
                        boxShadow: isToday ? '0 0 0 1px var(--accent)' : undefined,
                        background: inMonth ? 'var(--surface)' : 'var(--surface-2)',
                        opacity: inMonth ? 1 : 0.55,
                        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
                      }}
                      aria-label={`${fmtDate(date)} — ${evs.length ? `${evs.length} event${evs.length > 1 ? 's' : ''}` : 'no events'}`}>
                      <span className="u-xs tnum" style={{ fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--accent-text)' : inMonth ? 'var(--text-2)' : 'var(--text-3)' }}>
                        {date.getDate()}
                      </span>
                      {evs.slice(0, 2).map(e => (
                        <span key={e.id} className="u-xs u-truncate" style={{
                          display: 'block', maxWidth: '100%', padding: '1px 5px', borderRadius: 5,
                          background: `color-mix(in srgb, ${TYPE_COLOR[e.type]} 12%, transparent)`,
                          color: TYPE_COLOR[e.type], fontWeight: 560,
                        }}>{e.title}</span>
                      ))}
                      {evs.length > 2 && <span className="u-xs u-faint">+{evs.length - 2} more</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ---------- side panel ---------- */}
        <div style={{ flex: '1 1 300px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <Stat label="Next PTM" event={nextOf('ptm')} />
            <Stat label="Next exam" event={nextOf('exam')} />
          </div>

          {examConflicts.length > 0 && (
            <div className="card u-col" style={{ gap: 8, padding: 'var(--s-5)', borderColor: 'var(--danger-weak-2)', background: 'var(--danger-weak)' }}>
              <div className="u-flex u-small u-bold" style={{ gap: 7, color: 'var(--danger)' }}>
                <Icon.Alert size={15} /> Exam scheduling conflict
              </div>
              {examConflicts.map((group, i) => (
                <div key={i} className="u-small" style={{ color: 'var(--text-2)' }}>
                  {group.map(e => e.title).join(' + ')} — {fmtDateShort(group[0].on)} · {group[0].campus === 'all' ? 'all campuses' : seed.campuses.find(c => c.id === group[0].campus)?.name}
                </div>
              ))}
              <div className="u-xs u-faint">Policy: max one exam per campus per day.</div>
            </div>
          )}

          <Card head="Upcoming" actions={<span className="u-xs u-faint">{campus === 'all' ? 'all campuses' : seed.campuses.find(c => c.id === campus)?.name}</span>}>
            {upcoming.length === 0
              ? <Empty icon={<Icon.Clock size={20} />} title="Nothing upcoming" sub="No events match the filters for the coming weeks." />
              : (
                <div className="u-col">
                  {upcoming.map(e => (
                    <button key={e.id} className="u-flex" style={{ gap: 10, width: '100%', textAlign: 'left', padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                      onClick={() => setSelectedDay(e.on)}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: TYPE_COLOR[e.type], flexShrink: 0, marginTop: 5 }} />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontWeight: 570, fontSize: 'var(--text-md)' }} className="u-truncate">{e.title}</span>
                        <span className="u-xs u-faint">
                          {fmtDateShort(e.on)} · {fmtTime(e.on)}{e.location ? ` · ${e.location}` : ''} · {e.owner}
                        </span>
                      </span>
                      <Badge tone="outline">{countdown(e.on)}</Badge>
                    </button>
                  ))}
                </div>
              )}
          </Card>
        </div>
      </div>

      {/* ---------- day drawer ---------- */}
      <Drawer
        open={selectedDay !== null}
        onClose={() => setSelectedDay(null)}
        title={selectedDay ? weekdayLong(selectedDay) : ''}
        sub={selectedDay ? fmtDate(selectedDay) : undefined}
        footer={<Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setAddOpen(true)}>Add event</Button>}
      >
        {dayEvents.length === 0 ? (
          <Empty icon={<Icon.Calendar size={22} />} title="No events on this day" sub="The day is free across the selected campuses and event types." />
        ) : (
          <div className="u-col" style={{ gap: 12 }}>
            {dayEvents.map(e => (
              <div key={e.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 14 }}>
                <div className="u-between" style={{ gap: 8, marginBottom: 6 }}>
                  <span className="u-flex" style={{ gap: 8, fontWeight: 600, minWidth: 0 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: TYPE_COLOR[e.type], flexShrink: 0 }} />
                    <span className="u-truncate">{e.title}</span>
                  </span>
                  <Badge tone="outline">{TYPE_LABEL[e.type]}</Badge>
                </div>
                <div className="u-col u-small u-muted" style={{ gap: 3 }}>
                  <span className="u-flex" style={{ gap: 6 }}><Icon.Clock size={13} /> {fmtTime(e.on)}{e.durationMins > 0 ? ` · ${e.durationMins}m` : ''}</span>
                  <span className="u-flex" style={{ gap: 6 }}><Icon.Building size={13} /> {e.campus === 'all' ? 'All campuses' : seed.campuses.find(c => c.id === e.campus)?.name}</span>
                  {e.location && <span className="u-flex" style={{ gap: 6 }}><Icon.Compass size={13} /> {e.location}</span>}
                  <span className="u-flex" style={{ gap: 6 }}><Icon.User size={13} /> Owner: {e.owner}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {/* ---------- add event modal ---------- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add calendar event"
        sub={selectedDay ? `On ${fmtDate(selectedDay)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={14} />} disabled={!form.title.trim()} onClick={addEvent}>Save event</Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="cal-title">Title</label>
          <input id="cal-title" className="input" placeholder="e.g. Unit Test — English (6-8)" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="cal-type">Type</label>
            <select id="cal-type" className="select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as CalendarEvent['type'] }))}>
              {EVENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cal-campus">Campus</label>
            <select id="cal-campus" className="select" value={form.campus} onChange={e => setForm(f => ({ ...f, campus: e.target.value as CampusId | 'all' }))}>
              <option value="all">All campuses</option>
              {seed.campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="cal-time">Start time</label>
          <input id="cal-time" className="input" type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
        </div>
      </Modal>
    </>
  );
}

/* ---------- small pieces ---------- */
function Stat({ label, event }: { label: string; event?: CalendarEvent }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 'var(--text-lg)' }}>{event ? fmtDateShort(event.on) : '—'}</div>
      <div className="u-small u-muted">{event ? `${countdown(event.on)} · ${event.title}` : 'Nothing scheduled'}</div>
    </div>
  );
}

function weekdayLong(d: Date) {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}
