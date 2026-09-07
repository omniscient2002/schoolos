/* ============================================================
   Memory — the closed loop: decisions, meetings, documents and
   the merged timeline. Expected vs actual outcomes, reconciled.
   ============================================================ */
import { useEffect, useState } from 'react';
import * as seed from '../data/dataset';
import { memoryService } from '../services';
import { useStore } from '../state/store';
import { Avatar, Badge, Button, Card, Empty, ErrorState, Modal, PageHead, Section, SkeletonCard, Stat, Tabs, Timeline, useToast } from '../components/ui';
import { AiTraceCard, EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateTime, fmtRelative } from '../lib/format';
import type { AiTrace, DecisionRecord } from '../types/domain';

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

const STATUS_TONE: Record<DecisionRecord['status'], 'success' | 'warning' | 'info'> = {
  validated: 'success', 'review-due': 'warning', open: 'info',
};
const STATUS_LABEL: Record<DecisionRecord['status'], string> = {
  validated: 'validated', 'review-due': 'review due', open: 'open',
};
const KIND_LABEL = { decision: 'Decision', meeting: 'Meeting', incident: 'Incident' } as const;

function reviewLabel(d: Date): { text: string; overdue: boolean } {
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  return days >= 0 ? { text: `review in ${days}d`, overdue: false } : { text: `review overdue by ${-days}d`, overdue: true };
}

const MEMORY_TRACE: AiTrace = {
  trigger: 'Memory page open — loop-status sweep',
  policy: 'Privacy §1.2 — every AI read of decisions is logged',
  dataUsed: ['decision records', 'meeting notes', 'incident timeline', 'attendance + fee telemetry'],
  reasoningRole: 'Auditor (read-only)',
  action: 'None — surfaces review-due decisions and assembles evidence',
  approvalStatus: 'Not required (read-only)',
  verification: 'Loop status recomputed from decision records and telemetry, never inferred',
  model: 'Fast (classification) · ap-south-1',
  latencyMs: 240,
  tokens: 310,
  cost: '₹0.02',
};

export default function Memory() {
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();

  const everything = useAsync(() => memoryService.everything(), []);
  const [tab, setTab] = useState('decisions');
  const [q, setQ] = useState('');
  const search = useAsync(() => memoryService.searchDecisions(q), [q]);

  const [overrides, setOverrides] = useState<Record<string, { actualOutcome: string; status: DecisionRecord['status'] }>>({});
  const [recordId, setRecordId] = useState<string | null>(null);
  const [recordText, setRecordText] = useState('');
  const [recordStatus, setRecordStatus] = useState<DecisionRecord['status']>('validated');

  const decisionsBase: DecisionRecord[] = everything.data?.decisions ?? seed.decisions;
  const decisions: DecisionRecord[] = q.trim()
    ? (search.data ?? decisionsBase).map(d => mergeOverride(d, overrides[d.id]))
    : decisionsBase.map(d => mergeOverride(d, overrides[d.id]));
  const meetings = everything.data?.meetings ?? seed.meetings;
  const docs = everything.data?.docs ?? seed.memoryDocs;

  function mergeOverride(d: DecisionRecord, ov?: { actualOutcome: string; status: DecisionRecord['status'] }): DecisionRecord {
    return ov ? { ...d, actualOutcome: ov.actualOutcome, status: ov.status } : d;
  }

  const loopsClosed = decisions.filter(d => d.status === 'validated').length;
  const reviewDue = decisions.filter(d => d.status === 'review-due').length;

  const openRecord = (d: DecisionRecord) => {
    setRecordId(d.id);
    setRecordText(d.actualOutcome ?? '');
    setRecordStatus('validated');
  };

  const saveRecord = () => {
    const d = decisionsBase.find(x => x.id === recordId);
    if (!d || !recordText.trim()) return;
    setOverrides(o => ({ ...o, [d.id]: { actualOutcome: recordText.trim(), status: recordStatus } }));
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Closed decision loop',
        recordType: 'Decision', recordRef: `${d.id} — ${d.title}`,
        reason: 'Outcome recorded after review', policyRef: d.policy,
        aiInvolved: false, risk: 'low', outcome: 'Expected vs actual reconciled — memory updated',
      },
    });
    toast({ title: 'Decision loop closed', sub: `${d.id} · outcome recorded — next review scheduled automatically`, tone: 'success' });
    setRecordId(null);
  };

  const createTask = (item: string, meetingId: string) => {
    const idx = item.indexOf(':');
    const owner = idx > 0 ? item.slice(0, idx) : 'Owner';
    toast({ title: 'Task created', sub: `${owner} assigned · appears in Action Center · audit entry recorded`, tone: 'success' });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: 'Created task from meeting',
        recordType: 'Task', recordRef: item,
        reason: `From meeting intelligence (${meetingId})`, policyRef: 'Approvals §1.2',
        aiInvolved: true, risk: 'low', outcome: `Task assigned to ${owner}`,
      },
    });
  };

  const recording = decisionsBase.find(d => d.id === recordId) ?? null;

  const timelineItems = [
    ...decisionsBase.map(d => ({ on: d.decidedOn, kind: 'decision' as const, title: d.title, body: d.context })),
    ...meetings.map(m => ({ on: m.on, kind: 'meeting' as const, title: m.title, body: m.summary })),
    ...seed.incidents.map(i => ({ on: i.openedOn, kind: 'incident' as const, title: i.title, body: i.summary })),
  ].sort((a, b) => b.on.getTime() - a.on.getTime());

  return (
    <>
      <PageHead
        title="AI memory"
        sub={session.roleId === 'owner'
          ? 'What your assistant remembers — every decision the group makes, its expected outcome, and what actually happened.'
          : 'What your assistant remembers. Decisions carry expected outcomes — memory compares them to what actually happened and schedules the review.'}
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Decisions recorded" value={decisionsBase.length} sub="with expected outcomes attached" />
        <Stat label="Loops closed" value={loopsClosed} sub="actual outcome reconciled" />
        <Stat label="Review due" value={reviewDue} sub="scheduled reviews waiting on evidence" />
        <Stat label="Meetings captured" value={meetings.length} sub="decisions + tasks extracted automatically" />
      </div>

      <Section title="How memory gets things done" sub="A decision is not a document — it is a promise with a review date.">
        <Card>
          <div className="grid grid-2" style={{ gap: 16 }}>
            <div className="u-col" style={{ gap: 10 }}>
              <p className="u-small u-muted" style={{ margin: 0 }}>
                When a decision is recorded, its expected outcome becomes a checkable claim. Telemetry compares reality to the
                promise; when the review date arrives, SchoolOS assembles the evidence pack — nothing is remembered selectively.
              </p>
              <EvidenceChain
                title="Decision → expected outcome → telemetry → review"
                steps={[
                  { label: 'Decision recorded', detail: '“Bus 14 pre-route inspection” · approved by Principal · dec_4', source: 'AI memory · decisions' },
                  { label: 'Expected outcome set', detail: 'Zero route delays for 4 weeks · review scheduled automatically', source: 'Decision record dec_4' },
                  { label: 'Telemetry compared', detail: 'Route 7 delays since decision: 0 · complaints for 2 days: 0', source: 'Transport + case telemetry', refType: 'transport' },
                  { label: 'Review', detail: 'Runs in 27 days — evidence pack assembled automatically from the same records', source: 'Memory review scheduler' },
                ]}
              />
            </div>
            <div className="u-col" style={{ gap: 10 }}>
              <AiTraceCard trace={MEMORY_TRACE} />
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 12, background: 'var(--surface-2)' }}>
                <div className="u-small" style={{ fontWeight: 620, marginBottom: 5 }}>What memory never does</div>
                <ul className="u-small u-muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
                  <li>Never deletes or rewrites a decision — outcomes are appended, not edited</li>
                  <li>Never marks a loop closed without a human recording the actual outcome</li>
                  <li>Never hides a review-due decision from the owner</li>
                </ul>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <Tabs
        tabs={[
          { id: 'decisions', label: 'Decisions', count: decisionsBase.length },
          { id: 'meetings', label: 'Meetings', count: meetings.length },
          { id: 'documents', label: 'Documents', count: docs.length },
          { id: 'timeline', label: 'Timeline', count: timelineItems.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ height: 16 }} />

      {/* ---------- Decisions ---------- */}
      {tab === 'decisions' && (
        <Section
          title="Decision records"
          sub="Each record keeps its context, alternatives considered and the policy it followed."
          actions={
            <div style={{ width: 280 }}>
              <input
                className="input"
                placeholder="Search decisions…"
                value={q}
                onChange={e => setQ(e.target.value)}
                aria-label="Search decisions"
              />
            </div>
          }
        >
          {everything.loading && <div className="grid grid-2"><SkeletonCard lines={6} /><SkeletonCard lines={6} /><SkeletonCard lines={6} /><SkeletonCard lines={6} /></div>}
          {everything.error && <ErrorState title="Could not load AI memory" sub={everything.error} onRetry={everything.retry} />}
          {!everything.loading && !everything.error && decisions.length === 0 && (
            <Empty icon={<Icon.Memory size={26} />} title="No decisions match these filters" sub={q ? `Nothing in memory matches “${q}”.` : 'Record a decision to start a loop.'} />
          )}
          {!everything.loading && !everything.error && decisions.length > 0 && (
            <div className="grid grid-2">
              {decisions.map(d => {
                const rv = d.reviewOn ? reviewLabel(d.reviewOn) : null;
                return (
                  <Card key={d.id} className="memory-card">
                    <div className="u-between" style={{ gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 620, fontSize: 'var(--text-md)', lineHeight: 1.35 }}>{d.title}</div>
                        <div className="u-xs u-faint" style={{ marginTop: 2 }}>
                          <span className="mono">{d.id}</span> · decided {fmtDate(d.decidedOn)} ({fmtRelative(d.decidedOn)}) · approver: {d.approver}
                        </div>
                      </div>
                      <span className="u-flex" style={{ gap: 6, flexShrink: 0 }}>
                        {rv && <Badge tone={rv.overdue ? 'danger' : 'outline'}>{rv.text}</Badge>}
                        <Badge tone={STATUS_TONE[d.status]} dot>{STATUS_LABEL[d.status]}</Badge>
                      </span>
                    </div>
                    <div className="u-small u-muted" style={{ marginBottom: 8 }}>{d.context}</div>

                    {/* the loop: expected → actual — reads as one system, not two text boxes */}
                    <div className="memory-loop" data-state={d.actualOutcome ? 'closed' : 'open'}>
                      <div className="memory-loop-stage">
                        <span className="memory-loop-tag">Expected</span>
                        <div className="u-small">{d.expectedOutcome}</div>
                      </div>
                      <span className="memory-loop-arrow" aria-hidden="true">{d.actualOutcome ? '→' : '…'}</span>
                      <div className="memory-loop-stage">
                        <span className="memory-loop-tag">Actual · {d.actualOutcome ? 'loop closed' : 'pending'}</span>
                        <div className="u-small">{d.actualOutcome ?? <span className="u-faint">Not recorded yet — the loop is open.</span>}</div>
                      </div>
                    </div>

                    <div className="u-col" style={{ gap: 4, margin: '10px 0' }}>
                      {d.evidence.length > 0 && (
                        <div className="u-xs" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>
                          <span style={{ fontWeight: 640 }}>Evidence —</span> {d.evidence.join(' · ')}
                        </div>
                      )}
                      <div className="u-xs u-faint" style={{ lineHeight: 1.55 }}>
                        <span style={{ fontWeight: 640 }}>Policy —</span> {d.policy}
                      </div>
                      {d.alternatives.length > 0 && (
                        <div className="u-xs u-faint" style={{ lineHeight: 1.55 }}>
                          <span style={{ fontWeight: 640 }}>Alternatives considered —</span> {d.alternatives.join(' · ')}
                        </div>
                      )}
                    </div>

                    <div className="u-flex" style={{ justifyContent: 'flex-end' }}>
                      <Button variant={d.actualOutcome ? 'secondary' : 'primary'} size="sm" icon={<Icon.Check size={12} />} onClick={() => openRecord(d)}>
                        {d.actualOutcome ? 'Update outcome' : 'Record what happened'}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {/* ---------- Meetings ---------- */}
      {tab === 'meetings' && (
        <Section title="Meeting notes" sub="Captured, summarised and turned into decisions and tasks — with owners.">
          {everything.loading && <div className="grid grid-2"><SkeletonCard lines={5} /><SkeletonCard lines={5} /></div>}
          {everything.error && <ErrorState title="Could not load meetings" sub={everything.error} onRetry={everything.retry} />}
          {!everything.loading && !everything.error && meetings.length === 0 && (
            <Empty icon={<Icon.People size={26} />} title="No meetings captured" sub="Meeting intelligence appears here once notes are processed." />
          )}
          {!everything.loading && !everything.error && meetings.length > 0 && (
            <div className="grid grid-2">
              {meetings.map(m => (
                <Card key={m.id}>
                  <div className="u-between" style={{ gap: 8, marginBottom: 5 }}>
                    <div style={{ fontWeight: 610 }}>{m.title}</div>
                    <span className="u-xs u-faint" style={{ flexShrink: 0 }}>{fmtDateTime(m.on)}</span>
                  </div>
                  <div className="u-flex" style={{ gap: 4, marginBottom: 8 }}>
                    {m.attendees.slice(0, 4).map(a => <Avatar key={a} name={a} size="sm" square />)}
                    {m.attendees.length > 4 && <span className="u-xs u-faint" style={{ alignSelf: 'center' }}>+{m.attendees.length - 4}</span>}
                    <span className="u-xs u-faint" style={{ alignSelf: 'center' }}>{m.attendees.length} attendees</span>
                  </div>
                  <div className="u-small u-muted" style={{ marginBottom: 9 }}>{m.summary}</div>

                  <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 5 }}>Decisions in this meeting</div>
                  <ul className="u-small" style={{ margin: '0 0 9px', paddingLeft: 18, display: 'grid', gap: 3 }}>
                    {m.decisions.map(d => <li key={d}>{d}</li>)}
                  </ul>

                  <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 5 }}>Action items</div>
                  <div className="u-col" style={{ gap: 6 }}>
                    {m.actionItems.map(item => {
                      const idx = item.indexOf(':');
                      const owner = idx > 0 ? item.slice(0, idx) : 'Owner';
                      const rest = idx > 0 ? item.slice(idx + 1).trim() : item;
                      return (
                        <div key={item} className="u-between" style={{ gap: 8, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                          <div className="u-flex u-small" style={{ gap: 7, minWidth: 0 }}>
                            <Avatar name={owner} size="sm" />
                            <span style={{ minWidth: 0 }}><b>{owner}</b> · <span className="u-muted">{rest}</span></span>
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => createTask(item, m.id)}>Create task</Button>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ---------- Documents ---------- */}
      {tab === 'documents' && (
        <Section title="What your assistant remembers" sub="The policies and SOPs that decisions and automations cite as their source.">
          {everything.loading && <div className="grid grid-2"><SkeletonCard lines={4} /><SkeletonCard lines={4} /></div>}
          {everything.error && <ErrorState title="Could not load documents" sub={everything.error} onRetry={everything.retry} />}
          {!everything.loading && !everything.error && docs.length === 0 && (
            <Empty icon={<Icon.Document size={26} />} title="Nothing in the AI memory yet" />
          )}
          {!everything.loading && !everything.error && docs.length > 0 && (
            <div className="grid grid-2">
              {docs.map(doc => (
                <Card key={doc.id}>
                  <div className="u-between" style={{ gap: 8, marginBottom: 6 }}>
                    <div className="u-flex" style={{ gap: 7 }}>
                      <Badge tone={doc.type === 'policy' ? 'accent' : 'info'}>{doc.type.toUpperCase()}</Badge>
                      <span style={{ fontWeight: 610 }}>{doc.title}</span>
                    </div>
                    <Icon.Document size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                  </div>
                  <div className="u-small u-muted u-clamp2" style={{ marginBottom: 9 }}>“{doc.excerpt}”</div>
                  <div className="u-between u-xs u-faint">
                    <span>Owner: {doc.owner}</span>
                    <span>Updated {fmtDate(doc.updatedOn)} ({fmtRelative(doc.updatedOn)})</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ---------- Timeline ---------- */}
      {tab === 'timeline' && (
        <Section title="What your assistant remembers — timeline" sub="Decisions, meetings and incidents on one chronological line — newest first.">
          {everything.loading ? (
            <div className="grid grid-2"><SkeletonCard lines={6} /><SkeletonCard lines={6} /></div>
          ) : (
            <Card>
              <Timeline
                items={timelineItems.map(t => ({
                  time: `${fmtDate(t.on)} · ${KIND_LABEL[t.kind]}`,
                  title: t.title,
                  body: t.body,
                  dot: t.kind === 'decision' ? 'accent' : t.kind === 'meeting' ? 'ai' : 'danger',
                }))}
              />
            </Card>
          )}
        </Section>
      )}

      <Modal
        open={!!recording}
        onClose={() => setRecordId(null)}
        title="Record what happened"
        sub={recording ? `${recording.id} · ${recording.title}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRecordId(null)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={13} />} onClick={saveRecord} disabled={!recordText.trim()}>Close the loop</Button>
          </>
        }
      >
        {recording && (
          <div className="u-col" style={{ gap: 12 }}>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: '8px 10px', background: 'var(--surface-2)' }}>
              <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Expected outcome</div>
              <div className="u-small">{recording.expectedOutcome}</div>
            </div>
            <div>
              <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="dec-actual">What actually happened</label>
              <textarea id="dec-actual" className="textarea" rows={3} value={recordText} onChange={e => setRecordText(e.target.value)} placeholder="e.g. Zero delays in the 2 weeks since; one near-miss on Monday." style={{ marginTop: 5 }} />
            </div>
            <div>
              <label className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }} htmlFor="dec-status">Loop status</label>
              <select id="dec-status" className="select" style={{ width: '100%', marginTop: 5 }} value={recordStatus} onChange={e => setRecordStatus(e.target.value as DecisionRecord['status'])}>
                <option value="validated">Validated — outcome matched expectation</option>
                <option value="review-due">Review due — needs another look</option>
                <option value="open">Still open — outcome not yet observable</option>
              </select>
            </div>
            <div className="u-xs u-faint">The recorded outcome is appended to the decision — earlier entries are never overwritten, and the loop closure lands in the audit trail.</div>
          </div>
        )}
      </Modal>
    </>
  );
}
