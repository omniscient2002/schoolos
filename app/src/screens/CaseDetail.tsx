/* ============================================================
   CaseDetail — the case workspace: thread, notes, WhatsApp
   reply draft, SLA clock, similar cases and AI triage.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Badge, Button, Card, Dropdown, Empty, KeyValue, Modal, PageHead, Progress, Section, useToast } from '../components/ui';
import { AiTraceCard, EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtDateTime, fmtRelative } from '../lib/format';
import type { AiTrace, SchoolCase } from '../types/domain';

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const FLOW: SchoolCase['status'][] = ['open', 'triaged', 'in-progress', 'resolved', 'closed'];
const STATUS_LABEL: Record<SchoolCase['status'], string> = {
  open: 'Open', triaged: 'Triaged', 'in-progress': 'In-progress', resolved: 'Resolved', closed: 'Closed',
};
const STATUS_TONE: Record<SchoolCase['status'], 'info' | 'warning' | 'accent' | 'success' | 'neutral'> = {
  open: 'info', triaged: 'warning', 'in-progress': 'accent', resolved: 'success', closed: 'neutral',
};
const PRIORITY_TONE: Record<SchoolCase['priority'], 'danger' | 'warning' | 'neutral' | 'outline'> = {
  critical: 'danger', high: 'warning', normal: 'neutral', low: 'outline',
};
const ORIGIN_LABEL: Record<SchoolCase['origin'], string> = {
  'parent-whatsapp': 'WhatsApp', phone: 'Phone', 'walk-in': 'Walk-in', system: 'System', staff: 'Staff',
};
const CAMPUS_LABEL: Record<SchoolCase['campus'], string> = { north: 'North', city: 'City', east: 'East' };

function fmtH(hours: number): string {
  if (Math.abs(hours) < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return `${Math.round(hours)}h`;
}

function slaInfo(c: SchoolCase, now: number) {
  const elapsedH = (now - c.openedOn.getTime()) / 3600000;
  const leftH = c.slaHours - elapsedH;
  const pct = Math.max(0, Math.min(100, (elapsedH / c.slaHours) * 100));
  if (leftH <= 0) return { label: `SLA breached ${fmtH(-leftH)} ago`, tone: 'danger' as const, pct: 100 };
  if (pct > 75) return { label: `Deadline soon — ${fmtH(leftH)} left`, tone: 'warning' as const, pct };
  return { label: `${fmtH(leftH)} of ${c.slaHours}h left`, tone: 'neutral' as const, pct };
}

const TRIAGE_TRACE: AiTrace = {
  trigger: 'Case open — triage summary recomputed',
  policy: 'Communication §1.1 · Privacy §1.2 (reads logged)',
  dataUsed: ['case file', 'guardian thread', 'linked records', 'prior cases of the same kind'],
  reasoningRole: 'Triage (classify + link only)',
  action: 'Prepared the reply draft; sending needs staff approval',
  approvalStatus: 'Reply draft awaiting staff send',
  verification: 'Facts in the draft were matched against the case file',
  model: 'Fast (classification) · ap-south-1',
  latencyMs: 290,
  tokens: 380,
  cost: '₹0.01',
};

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const { domain, dispatch, actorName, session } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow();

  const c = domain.cases.find(x => x.id === id) ?? null;
  const [notes, setNotes] = useState<Record<string, SchoolCase['messages']>>({});
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  if (!c) {
    return (
      <>
        <PageHead title="Case not found" back={{ to: '/cases', label: 'Back to cases' }} />
        <Empty
          icon={<Icon.Clipboard size={26} />}
          title="This case does not exist"
          sub={`No case with id “${id}” is in the live case list. It may have been merged or archived.`}
          action={<Button variant="primary" onClick={() => navigate('/cases')}>Back to cases</Button>}
        />
      </>
    );
  }

  const thread = [...c.messages, ...(notes[c.id] ?? [])];
  const sla = slaInfo(c, now);
  const similar = seed.cases.filter(x => x.kind === c.kind && x.id !== c.id);
  const lastActivity = thread.length ? thread[thread.length - 1].on : c.openedOn;

  const buildReply = (k: SchoolCase): string => {
    const linked = k.linkedRecords?.length ? k.linkedRecords.map(l => l.label).join(', ') : 'the linked records';
    return [
      'Dear Parent,',
      '',
      `Thank you for writing to us about “${k.title.replace(/\.$/, '')}”. Here is where things stand:`,
      '',
      `· Your case (${k.id}) is owned by ${k.owner} — current status: ${STATUS_LABEL[k.status].toLowerCase()}.`,
      `· We are reviewing ${linked} and will confirm the resolution steps shortly.`,
      '· You will hear from us within 24 hours, or sooner if anything changes.',
      '',
      'If you would like to discuss this, reply here and we will call you back.',
      '',
      `— ${k.owner}, ${CAMPUS_LABEL[k.campus]} Campus, Meridian International Academy`,
    ].join('\n');
  };

  const openReply = () => {
    setReplyText(buildReply(c));
    setReplyOpen(true);
  };

  const advance = (next: SchoolCase['status']) => {
    dispatch({ type: 'case/advance', id: c.id, status: next, actor: actorName, note: `Status advanced to ${STATUS_LABEL[next]}` });
    toast({ title: `Case moved to ${STATUS_LABEL[next]}`, sub: `${c.id} · audit entry recorded`, tone: 'success' });
  };

  const addNote = () => {
    if (!noteText.trim()) return;
    setNotes(n => ({ ...n, [c.id]: [...(n[c.id] ?? []), { on: new Date(), from: `${actorName} (${session.roleId})`, text: noteText.trim(), internal: true }] }));
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Note added to case',
        recordType: 'Case', recordRef: `${c.id} — ${c.title}`,
        reason: noteText.trim().slice(0, 120), aiInvolved: false, risk: 'low',
        outcome: 'Internal note appended to the case file',
      },
    });
    toast({ title: 'Note added to the case file', sub: 'Internal — never visible to guardians', tone: 'success' });
    setNoteText('');
    setNoteOpen(false);
  };

  const sendReply = () => {
    if (!replyText.trim()) return;
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Reply sent via WhatsApp',
        recordType: 'Communication', recordRef: `${c.id} — ${c.title}`,
        reason: 'Guardian-facing reply drafted from case facts', policyRef: 'Communication §2.1',
        aiInvolved: true, risk: 'low',
        outcome: 'Reply queued for delivery · logged to comm log + audit',
      },
    });
    toast({ title: 'Reply queued for delivery · logged to comm log + audit', sub: `To the guardian of ${c.id} · template respected quiet hours`, tone: 'success' });
    setReplyOpen(false);
    setReplyText('');
  };

  const escalate = () => {
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Sent case to the Principal',
        recordType: 'Case', recordRef: `${c.id} — ${c.title}`,
        reason: 'Needs a decision above the current owner', aiInvolved: false, risk: 'high',
        outcome: 'Recorded · the Principal can see it in the Action Center',
      },
    });
    toast({ title: 'Case sent to the Principal', sub: 'They now have 4 hours to respond · saved to the activity log', tone: 'success' });
  };

  const idx = FLOW.indexOf(c.status);
  const nexts = FLOW.slice(idx + 1);

  return (
    <>
      <PageHead
        title={c.title}
        sub={`${c.id} · opened ${fmtDateTime(c.openedOn)} (${fmtRelative(c.openedOn)}) by ${ORIGIN_LABEL[c.origin].toLowerCase()}`}
        back={{ to: '/cases', label: 'Back to cases' }}
        actions={
          <>
            {nexts.length > 0 ? (
              <Dropdown
            label="Status advance" trigger={() => <Button variant="primary" icon={<Icon.ArrowRight size={13} />}>Advance status</Button>} align="left">
                {close => (
                  <div className="u-col" style={{ padding: 4 }}>
                    {nexts.map(s => (
                      <button
                        key={s}
                        role="menuitem"
                        className="u-small"
                        style={{ textAlign: 'left', padding: '7px 10px', borderRadius: 8, cursor: 'pointer', border: 'none', background: 'transparent' }}
                        onClick={() => { advance(s); close(); }}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}
              </Dropdown>
            ) : (
              <Badge tone="success" dot>{STATUS_LABEL[c.status]}</Badge>
            )}
            <Button variant="secondary" icon={<Icon.Edit size={13} />} onClick={() => setNoteOpen(true)}>Add note</Button>
            <Button variant="secondary" icon={<Icon.Message size={13} />} onClick={openReply}>Reply via WhatsApp</Button>
            <Button variant="danger-ghost" icon={<Icon.Flag size={13} />} onClick={escalate}>Escalate</Button>
          </>
        }
      />

      <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        <Badge tone="outline">{c.kind}</Badge>
        <Badge tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Badge>
        <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority} priority</Badge>
        <Badge tone={sla.tone === 'danger' ? 'danger' : sla.tone === 'warning' ? 'warning' : 'outline'}>{sla.label}</Badge>
        <Badge tone="info">{ORIGIN_LABEL[c.origin]}</Badge>
        <Badge tone="neutral">{CAMPUS_LABEL[c.campus]} campus</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        {/* ---------- left: thread + linked records ---------- */}
        <div className="u-col" style={{ gap: 18 }}>
          <Section title="Case file" sub={`Messages and notes in chronological order · last activity ${fmtRelative(lastActivity)}`}>
            <div className="u-col" style={{ gap: 10 }}>
              {thread.length === 0 && <Empty title="No entries yet" sub="Notes and messages will appear here as the case is worked." />}
              {thread.map((m, i) => (
                <div
                  key={`${m.on.getTime()}-${i}`}
                  style={{
                    border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px',
                    background: m.internal ? 'var(--surface-2)' : 'var(--surface)',
                    borderLeft: m.internal ? '3px solid var(--warning)' : '3px solid var(--border-strong)',
                  }}
                >
                  <div className="u-between" style={{ marginBottom: 4 }}>
                    <span className="u-small" style={{ fontWeight: 620 }}>{m.from}</span>
                    <span className="u-flex" style={{ gap: 6 }}>
                      {m.internal && <Badge tone="warning">Internal note</Badge>}
                      <span className="u-xs u-faint">{fmtDateTime(m.on)}</span>
                    </span>
                  </div>
                  <div className="u-small" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Linked records" sub="Records the triage attached — click to open them.">
            <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
              {(c.linkedRecords ?? []).length === 0 && <span className="u-small u-faint">No linked records on this case yet.</span>}
              {(c.linkedRecords ?? []).map(l => (
                <button
                  key={l.label}
                  className="u-flex u-xs"
                  style={{ gap: 5, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px', background: 'var(--surface)', cursor: 'pointer' }}
                  onClick={() => navigate(l.ref)}
                >
                  <Icon.ArrowUpRight size={11} />{l.label}
                </button>
              ))}
            </div>
          </Section>
        </div>

        {/* ---------- right: meta, SLA, similar, AI ---------- */}
        <div className="u-col" style={{ gap: 18 }}>
          <Card>
            <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>Case details</div>
            <KeyValue
              items={[
                { k: 'Case ID', v: <span className="mono">{c.id}</span> },
                { k: 'Kind', v: c.kind },
                { k: 'Status', v: <Badge tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Badge> },
                { k: 'Priority', v: <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge> },
                { k: 'Origin', v: ORIGIN_LABEL[c.origin] },
                { k: 'Campus', v: CAMPUS_LABEL[c.campus] },
                { k: 'Opened by', v: c.openedBy },
                { k: 'Owner', v: c.owner },
                { k: 'Opened on', v: fmtDate(c.openedOn) },
                { k: 'Deadline', v: `${c.slaHours}h` },
              ]}
            />
          </Card>

          <Card>
            <div className="u-between" style={{ marginBottom: 8 }}>
              <span className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Deadline</span>
              <Badge tone={sla.tone === 'danger' ? 'danger' : sla.tone === 'warning' ? 'warning' : 'outline'}>{sla.label}</Badge>
            </div>
            <Progress value={sla.pct} tone={sla.tone === 'danger' ? 'danger' : sla.tone === 'warning' ? 'warn' : undefined} />
            <div className="u-xs u-faint" style={{ marginTop: 7 }}>
              {fmtH(Math.max(0, (now - c.openedOn.getTime()) / 3600000))} elapsed of {c.slaHours}h · resets never — extensions require the Principal.
            </div>
          </Card>

          <Card>
            <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>Similar past cases · {c.kind}</div>
            {similar.length === 0 && <span className="u-small u-faint">No similar cases in history.</span>}
            <div className="u-col" style={{ gap: 8 }}>
              {similar.map(s => (
                <div
                  key={s.id}
                  className="u-between card-click"
                  role="button"
                  tabIndex={0}
                  style={{ gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', cursor: 'pointer' }}
                  onClick={() => navigate(`/cases/${s.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/cases/${s.id}`); } }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="u-small u-truncate" style={{ fontWeight: 570 }}>{s.title}</div>
                    <div className="u-xs u-faint">{s.id} · {fmtDateShort(s.openedOn)} · {s.owner}</div>
                  </div>
                  <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>AI triage</div>
            <div className="u-col" style={{ gap: 10 }}>
              <EvidenceChain
                title={`How ${c.id} was triaged`}
                steps={[
                  { label: 'Origin', detail: `${ORIGIN_LABEL[c.origin]} · opened by ${c.openedBy}`, source: 'Communication log' },
                  { label: 'Language', detail: c.origin === 'parent-whatsapp' ? 'Detected: English · Hindi template attached for the reply' : 'Not applicable — internal origin', source: 'Reply classifier' },
                  { label: 'Sentiment', detail: c.kind === 'complaint' ? 'Frustrated — priority raised, reply drafted with acknowledgement' : 'Neutral — routine handling', source: 'Sentiment scorer' },
                  { label: 'Linked records', detail: (c.linkedRecords ?? []).length ? (c.linkedRecords ?? []).map(l => l.label).join(' · ') : 'None attached yet', source: 'Record linker · verified IDs' },
                ]}
              />
              <AiTraceCard trace={TRIAGE_TRACE} compact />
            </div>
          </Card>
        </div>
      </div>

      {/* ---------- add note modal ---------- */}
      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Add internal note"
        sub={`${c.id} · notes are visible to staff only and land in the case file with your name.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={13} />} onClick={addNote} disabled={!noteText.trim()}>Add note</Button>
          </>
        }
      >
        <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="case-note">Note</label>
        <textarea id="case-note" className="textarea" rows={4} style={{ width: '100%', marginTop: 5 }} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="e.g. Called the guardian — bus pass renewal confirmed for Monday." />
      </Modal>

      {/* ---------- whatsapp reply modal ---------- */}
      <Modal
        open={replyOpen}
        onClose={() => setReplyOpen(false)}
        title="Reply via WhatsApp"
        sub={`${c.id} · draft pre-filled from the case facts — edit freely before sending.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReplyOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Send size={13} />} onClick={sendReply} disabled={!replyText.trim()}>Send reply</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 10 }}>
          <div className="u-xs u-faint">To: the guardian on this case · via WhatsApp · template honors quiet hours 20:30–07:30</div>
          <textarea className="textarea" rows={12} style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-sm)' }} value={replyText} onChange={e => setReplyText(e.target.value)} aria-label="WhatsApp reply draft" />
        </div>
      </Modal>
    </>
  );
}
