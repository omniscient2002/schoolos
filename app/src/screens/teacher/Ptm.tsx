/* PTM — P11 · parent-teacher meetings (PRD-1). Publish slots, see bookings,
   keep strictly private notes (RLS-pinned to the meeting teacher). */
import { useState } from 'react';
import { Badge, Button, Card, Empty, Modal, PageHead, Section, SkeletonCard, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDate } from '../../lib/format';
import { useStore } from '../../state/store';
import {
  createPtmSlot, listPtmMeetings, listPtmNotes, listPtmSlots, savePtmNotes,
  type PtmMeeting, type PtmSlot,
} from '../../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacherKit';

export default function Ptm() {
  const toast = useToast();
  const { session, actorName } = useStore();
  const allowed = useTeacherAccess('/teacher/homework');

  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 10); });
  const [start, setStart] = useState('15:00');
  const [end, setEnd] = useState('15:15');
  const [saving, setSaving] = useState(false);
  const [noteOn, setNoteOn] = useState<PtmMeeting | null>(null);
  const [noteText, setNoteText] = useState('');
  const [existing, setExisting] = useState<string[]>([]);

  const slots = useAsync(() => listPtmSlots(actorName), [actorName]);
  const meetings = useAsync(() => listPtmMeetings(actorName), [actorName]);

  const publish = async () => {
    if (!date || !start || !end) { toast({ title: 'Pick a date and a start and end time', tone: 'info' }); return; }
    setSaving(true);
    try {
      await createPtmSlot({ date, startTime: start, endTime: end });
      toast({ title: 'Slot published', sub: 'Parents can now book this time.', tone: 'success' });
      slots.retry();
    } catch (e) {
      toast({ title: 'Could not publish the slot', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };

  const openNotes = async (m: PtmMeeting) => {
    setNoteOn(m); setNoteText(''); setExisting([]);
    if (!m.bookingId) return;
    try {
      const d = await listPtmNotes(m.bookingId);
      setExisting((d.notes ?? []).map(n => n.note));
    } catch { /* notes door may be unavailable; the form still works */ }
  };

  const saveNote = async () => {
    if (!noteOn?.bookingId || !noteText.trim()) return;
    setSaving(true);
    try {
      await savePtmNotes(noteOn.bookingId, noteText.trim());
      toast({ title: 'Private note saved', sub: 'Only you can see this.', tone: 'success' });
      setExisting(prev => [...prev, noteText.trim()]);
      setNoteText('');
    } catch (e) {
      toast({ title: 'Could not save the note', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };

  if (!allowed) return <DeniedState role={session.roleId} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead title="Parent meetings" sub="Publish the times you are free; parents book. Meeting notes stay private to you." />

      <Section title="Publish a slot" sub="One slot per call — publish several for a block.">
        <Card pad>
          <div className="grid grid-3" style={{ gap: '0 14px' }}>
            <div className="field"><label htmlFor="ptm-date">Date</label>
              <input id="ptm-date" className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="field"><label htmlFor="ptm-start">Start</label>
              <input id="ptm-start" className="input" type="time" value={start} onChange={e => setStart(e.target.value)} /></div>
            <div className="field"><label htmlFor="ptm-end">End</label>
              <input id="ptm-end" className="input" type="time" value={end} onChange={e => setEnd(e.target.value)} /></div>
          </div>
          <div className="u-between u-wrap" style={{ gap: 10 }}>
            <span className="u-small u-muted">A parent books for their own child only.</span>
            <Button variant="primary" icon={<Icon.Calendar size={14} />} loading={saving} onClick={publish}>Publish slot</Button>
          </div>
        </Card>
      </Section>

      <Section title="My slots" sub="Open and booked times on your board.">
        <AsyncGate state={slots} skeleton={<SkeletonCard lines={4} />}
          empty={<Empty icon={<Icon.Calendar size={22} />} title="No slots yet" sub="Publish the first time above." />}>
          {({ slots: rows }) => rows.length === 0
            ? <Empty icon={<Icon.Calendar size={22} />} title="No slots yet" sub="Publish the first time above." />
            : (
              <div className="u-flex u-wrap" style={{ gap: 8 }}>
                {rows.map(s => <SlotChip key={s.slotId} slot={s} />)}
              </div>
            )}
        </AsyncGate>
      </Section>

      <Section title="Booked meetings" sub="Parents who have booked a time with you.">
        <AsyncGate state={meetings} skeleton={<SkeletonCard lines={4} />}
          empty={<Empty icon={<Icon.Users size={22} />} title="No bookings yet" sub="Bookings appear here as parents sign up." />}>
          {({ meetings: rows }) => rows.length === 0
            ? <Empty icon={<Icon.Users size={22} />} title="No bookings yet" sub="Bookings appear as parents sign up." />
            : (
              <div className="u-col" style={{ gap: 10 }}>
                {rows.map(m => (
                  <Card key={m.slotId} pad className="u-between">
                    <div>
                      <div style={{ fontWeight: 570 }}>{m.studentName}</div>
                      <div className="u-small u-muted">{fmtDate(m.date)} · {m.startTime}</div>
                    </div>
                    <Button size="sm" variant="secondary" icon={<Icon.Document size={13} />} onClick={() => openNotes(m)}>Private notes</Button>
                  </Card>
                ))}
              </div>
            )}
        </AsyncGate>
      </Section>

      <Modal open={noteOn !== null} onClose={() => setNoteOn(null)}
        title={noteOn ? `Notes — ${noteOn.studentName}` : ''} sub="Strictly private: only you can read these."
        footer={<><Button variant="ghost" onClick={() => setNoteOn(null)}>Close</Button><Button variant="primary" loading={saving} disabled={!noteText.trim()} onClick={saveNote}>Save note</Button></>}>
        <div className="u-col" style={{ gap: 10 }}>
          {existing.length > 0 && (
            <div className="u-col" style={{ gap: 6 }}>
              {existing.map((n, i) => <div key={i} className="u-small" style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>{n}</div>)}
            </div>
          )}
          <div className="field"><label htmlFor="ptm-note">New note</label>
            <textarea id="ptm-note" className="textarea" rows={3} value={noteText} onChange={e => setNoteText(e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  );
}

function SlotChip({ slot }: { slot: PtmSlot }) {
  return (
    <span className="u-flex" style={{ gap: 6, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '6px 10px' }}>
      <span className="u-small">{fmtDate(slot.date)} · {slot.startTime}</span>
      <Badge tone={slot.booked ? 'success' : 'neutral'} dot>{slot.booked ? 'booked' : 'open'}</Badge>
    </span>
  );
}
